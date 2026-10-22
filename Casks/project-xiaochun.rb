cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.36"
  sha256 arm:   "9ed44a5a0866b241cc8fd2f3c9372d8cd047ab323e0163f0f983421a9d887859",
         intel: "9ad54b49c9c15bafad76769527c25a5e90f2c1d5f6e5f509804b9e20e46925ca"

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
