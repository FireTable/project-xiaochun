cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.29"
  sha256 arm:   "4a461a0874542fa9cd4a29c569fe98334b1a736b097896acde6b56a543d7a46b",
         intel: "ff5cb68d2a1aa4fe434a3134f07f0f3a1f1db96d26ae0401d2f78c043ebf2a04"

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
