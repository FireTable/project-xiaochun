cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.11"
  sha256 arm:   "1b3f859e0df6c3c158c3d4c402fd08fae0a4a5fc07296dfcf4502347e2d77e2a",
         intel: "7229d938c8dd74341713d7fa08eb989ca0b719a42943fad30dd2eb494233e402"

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
