cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.10"
  sha256 arm:   "f8875aafeca1b0fd352b8bfc86d90a00fa465be5ba36420632b3e9f55d752b3a",
         intel: "3e0956821552b9f4298db5bcb7e41a8ddb765aede5c17f24355549af1d9f637d"

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
