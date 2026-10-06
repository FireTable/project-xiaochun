cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.18"
  sha256 arm:   "7a96d9527fbaa1e963167e099e2bc14afe3992e711f36e77a33b5b3ff0a0574a",
         intel: "c0e30b77c1412538556100bd7507af998c3ef429b938883dc4b38b9946ee76db"

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
