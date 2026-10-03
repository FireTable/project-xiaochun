cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.14"
  sha256 arm:   "2c74f7088973e5022478ba86c0da25b2ae7ec61593b69c449b0b9155381d793a",
         intel: "d32083f36761e24323f64b1ece840d8d9ff7059b06906cbb456fceb41ccd53d1"

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
