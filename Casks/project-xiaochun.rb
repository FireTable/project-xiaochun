cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.17"
  sha256 arm:   "3fea2e6fa5832b817e86cb3476f26f28a96bec927f103172f8778ed3b3113ac3",
         intel: "d6dc93580a5b787bedaedd480d16efb6327a0ef359bdf257486614ac51dd66b3"

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
