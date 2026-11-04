cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.9"
  sha256 arm:   "096fa9b9762f949dee3dbb2dfa99498c9a59d152df73f66bbe2e2f8049919749",
         intel: "b06eca6e9a60bc48d33907ea2af7edd8a1f844d9bc51b3824eef46629c8328f8"

  url "https://github.com/FireTable/project-xiaochun/releases/download/v#{version}/Project.XiaoChun_#{version}_#{arch}.dmg"
  name "Project XiaoChun"
  desc "100% Client-Native Anime Companion & Transparent Desktop Pet"
  homepage "https://github.com/FireTable/project-xiaochun"

  depends_on :macos

  app "Project XiaoChun.app"

  postflight_steps do
    run "/usr/bin/xattr", args: ["-cr", "/Applications/Project XiaoChun.app"]
  end

  zap trash: [
    "~/Library/Application Support/tech.firetable.xiaochun",
    "~/Library/Preferences/tech.firetable.xiaochun.plist",
    "~/Library/Saved Application State/tech.firetable.xiaochun.savedState",
  ]
end
