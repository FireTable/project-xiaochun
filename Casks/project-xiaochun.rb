cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.31"
  sha256 arm:   "1738f65256d172a7dca854741f966b7aa74b2540028571fdd2d1080a613706b5",
         intel: "8d89280503a6bd718c0db8a3d406e6bb30311a42c370b6ad3386be7f24fb7763"

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
