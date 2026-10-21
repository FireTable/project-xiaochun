cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.32"
  sha256 arm:   "0409af6952c429ae0678ae7278088689da48163d1ca44098ded29632d693a6bd",
         intel: "315deec3217dde2a2701a9605e18fda97237275d0a8702d6c92d69be7dc56717"

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
