cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.8"
  sha256 arm:   "e94760d46ce608e5c7c3f70670a0c6289b118288dd8b0809a68360fa0748b515",
         intel: "19399006fda0bef54861195329a9b1c437db1c0ba9d8b1cb0bb59b04e3e421f6"

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
