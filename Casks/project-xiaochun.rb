cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.33"
  sha256 arm:   "42fe65cb1d6fba6174e135b4fbd8935f58c1525ebec89811dca8e3e490b56f2b",
         intel: "b7545ca91e6b851ddc979d796f17718bef5d9c6f4d2c1fc431c42fe52cd47740"

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
