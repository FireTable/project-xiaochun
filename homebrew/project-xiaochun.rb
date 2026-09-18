cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.2"
  sha256 arm:   "c314997148898771c110a9d33e1564378b2fb96726bf2df457c4c1f0f8f45233",
         intel: "a8417afa5260712b5ff7f16975e49b7bc99446f2a71672e1136dd6f8797db5f1"

  url "https://github.com/FireTable/project-xiaochun/releases/download/v#{version}/Project.XiaoChun_#{version}_#{arch}.dmg"
  name "Project XiaoChun"
  desc "100% Client-Native Anime Companion & Transparent Desktop Pet"
  homepage "https://github.com/FireTable/project-xiaochun"

  app "Project XiaoChun.app"

  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-cr", "#{appdir}/Project XiaoChun.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Application Support/tech.firetable.xiaochun",
    "~/Library/Preferences/tech.firetable.xiaochun.plist",
    "~/Library/Saved Application State/tech.firetable.xiaochun.savedState",
  ]
end
