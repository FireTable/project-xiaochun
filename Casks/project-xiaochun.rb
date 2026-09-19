cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.5"
  sha256 arm:   "1a564dbd82aee57a65fb330ca4227ef82a433744be1bd3f3dfc310c18a043e88",
         intel: "0d70ae3414c8b66ffcf35480d68f05fa9218e06994a3dd917bef3cacfa5be69d"

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
