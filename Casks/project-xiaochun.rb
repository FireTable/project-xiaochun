cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.10"
  sha256 arm:   "07ddbd19e9d0f75fce2cda2b12448aed1271f366b118c03c18c67ef0b240623c",
         intel: "ec730eb5e84619027bf2d4ac7f8e796ca422cf08c693aed7bcff85e38733bc95"

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
