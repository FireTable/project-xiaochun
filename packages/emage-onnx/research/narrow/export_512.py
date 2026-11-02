import os
import numpy as np
import torch
import onnx
from onnx import helper, numpy_helper, TensorProto
import onnxruntime as ort
from collections import defaultdict
from distill_768 import OUT, make_student

CKPT = os.path.join(OUT, "last.pt")
DEST = os.path.join(OUT, "emage_step_512_final.onnx")

def quantize_conv_dq(in_path, out_path, min_params=1024):
    m = onnx.load(in_path)
    g = m.graph
    init = {i.name: i for i in g.initializer}
    consumers = {}
    for n in g.node:
        for i in n.input:
            consumers.setdefault(i, []).append(n)
    done = 0
    for n in list(g.node):
        if n.op_type != "Conv" or n.input[1] not in init:
            continue
        wname = n.input[1]
        if len(consumers.get(wname, [])) != 1:
            continue
        w = numpy_helper.to_array(init[wname]).astype(np.float32)
        if w.size < min_params:
            continue
        flat = w.reshape(w.shape[0], -1)
        scale = np.abs(flat).max(axis=1) / 127.0
        scale[scale == 0] = 1.0
        q = np.clip(np.round(flat / scale[:, None]), -127, 127).astype(np.int8).reshape(w.shape)
        qn, sn, dn = wname + "_q8", wname + "_q8_scale", wname + "_dq"
        g.initializer.append(numpy_helper.from_array(q, qn))
        g.initializer.append(numpy_helper.from_array(scale.astype(np.float32), sn))
        dq = helper.make_node("DequantizeLinear", [qn, sn], [dn], axis=0, name=n.name + "_wdq")
        g.node.insert(list(g.node).index(n), dq)
        n.input[1] = dn
        g.initializer.remove(init[wname])
        done += 1
    onnx.save(m, out_path)
    return done

blob = torch.load(CKPT, map_location="cpu")
student = make_student(blob["width"]).cpu().eval()
student.m.load_state_dict(blob["model"])
print("step", blob["step"], "width", blob["width"], flush=True)

audio = torch.randn(1, 34112)
speaker = torch.zeros(1, 1, dtype=torch.long)
motion = torch.randn(1, 64, 337)
mask = torch.ones(1, 64, 337)
mask[:, :4] = 0
fp32 = os.path.join(OUT, "emage_step_512.onnx")
with torch.no_grad():
    torch.onnx.export(
        student, (audio, speaker, motion, mask), fp32,
        input_names=["audio", "speaker_id", "masked_motion", "mask"],
        output_names=["cls_upper", "cls_hands", "cls_lower"],
        opset_version=17, dynamo=False, do_constant_folding=True,
    )
from onnxruntime.quantization import quantize_dynamic, QuantType
int8 = os.path.join(OUT, "emage_step_512_int8.onnx")
quantize_dynamic(fp32, int8, weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul"])
convq = os.path.join(OUT, "emage_step_512_convq.onnx")
nconv = quantize_conv_dq(int8, convq)
print("convq", nconv, os.path.getsize(convq), flush=True)

so = ort.SessionOptions()
so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_EXTENDED
so.optimized_model_filepath = DEST
so.log_severity_level = 3
so.add_session_config_entry("optimization.disable_specified_optimizers", "NchwcTransformer")
ort.InferenceSession(convq, so, providers=["CPUExecutionProvider"])
model = onnx.load(DEST)
bad = [f"{n.domain}::{n.op_type}" for n in model.graph.node if "nchwc" in (n.domain or "").lower() or "nhwc" in (n.domain or "").lower()]
if bad:
    os.remove(DEST)
    raise SystemExit(f"bad ops {bad[:8]}")
kinds = defaultdict(int)
for init in model.graph.initializer:
    kinds[str(numpy_helper.to_array(init).dtype)] += numpy_helper.to_array(init).nbytes
print("final_bytes", os.path.getsize(DEST), flush=True)
for k, b in sorted(kinds.items(), key=lambda kv: -kv[1]):
    print(f"  {k} {b/1e6:.2f} MB", flush=True)
