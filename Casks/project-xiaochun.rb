cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.22"
  sha256 arm:   "0fab6102db85b022c364dad3d7c6fec8c57daf1ebc20d6737bebe1badc1cecb3",
         intel: "9237c4081dc3312e0469756784b6541a0138168d78c8d5777445fbb42daf8b3a"

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
