cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.2"
  sha256 arm:   "09348742a35feb7d5027c690bbd1fac4895409aed3735901db025705a84c6eb4",
         intel: "3bace904ad8d22d3354d375478f1b89c622cdbb1cf49d5cdfd745096c2b4fd31"

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
