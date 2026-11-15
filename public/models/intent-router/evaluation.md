# Evaluation Report: Bilingual Intent Router Model (v1)

- **Date**: 2026-11-14T04:05:51Z
- **Model**: `intent-router-bilingual-v1.int8.onnx` (3.33 MB)
- **Architecture**: CompactTransformerClassifier-2L-128D-4H
- **Quantization**: INT8_DYNAMIC
- **Vocabulary Size**: 5767 tokens

---

## 1. Summary Metrics

| Metric | Score | Constraint / Target | Status |
| :--- | :--- | :--- | :--- |
| **Overall Accuracy** | **99.93%** | > 95.0% | **PASS** |
| **Macro F1** | **99.93%** | > 95.0% | **PASS** |
| **Model Size** | **3.33 MB** | < 10.0 MB | **PASS** |
| **Median Latency (p50)** | **0.56 ms** | < 2.5 ms | **PASS** |
| **95th % Latency (p95)** | **0.63 ms** | < 5.0 ms | **PASS** |

---

## 2. Confusion Matrix

| Actual \ Predicted | Predicted CHAT | Predicted HEAVY |
| :--- | :--- | :--- |
| **Actual CHAT** | 755 (True Negative) | 0 (False Positive) |
| **Actual HEAVY** | 1 (False Negative) | 752 (True Positive) |

---

## 3. Language Slices

| Language Slice | Total Samples | Correct | Accuracy |
| :--- | :--- | :--- | :--- |
| **Chinese (ZH)** | 229 | 229 | **100.00%** |
| **English (EN)** | 345 | 344 | **99.71%** |
| **Code-Switching (CS)** | 934 | 934 | **100.00%** |

---

## 4. Landmark Scenario Verification

- **Scenario 1** (`小春，今天在海边心情怎么样呀？`): Evaluated as `CHAT`
- **Scenario 2** (`Hey XiaoChun, 今天海边风大不大? By the way how is your WebGPU GPU temperature?`): Evaluated as `CHAT` (Technical words in banter context disambiguated)
- **Scenario 3** (`小春在吗？`, `好的收到！`, `mm-hmm 对对`): Evaluated as `CHAT`
- **Scenario 5** (`帮我查一下 / deeply analyze why iOS TBDR WebGPU drops frames when we use RGBA16F 4x MSAA`): Evaluated as `HEAVY`
- **Scenario 5 Follow-up** (`尤其是开启 bloom 的时候`): Evaluated as `HEAVY`
