cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.2"
  sha256 arm:   "56bd7fb7e40357dd7559c5fbe4d1eb84b83b097d68b5185d94713bdc9c3ecf04",
         intel: "5aa004dc7cbe9d61f91ce4274c842226054d7b50abcac49baa85c71262512a27"

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
