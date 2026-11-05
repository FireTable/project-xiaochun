cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.9"
  sha256 arm:   "4e9ddc998086de8355bbd420ff93837237b2d922a4ee4b053c6822694ec66020",
         intel: "e6012952c91a4b7f09ed979e85954d9a34e4cebda422d3e3e451ef9937a85ef2"

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
