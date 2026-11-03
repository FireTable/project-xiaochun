cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.5"
  sha256 arm:   "c6e2c212b61d0b42f112f29054fc197140d9db742daeac28fc4c35532aa0ca8e",
         intel: "d2204bb5b25a40c7494689e12bba24ae2242cb90cac4da044c2ecf537493ea17"

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
