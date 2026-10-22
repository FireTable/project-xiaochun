cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.34"
  sha256 arm:   "47a8c679ac2cee8079a79ab0a1411e0a70b0bb81a98443f363a19a6382abbd3e",
         intel: "ec860407c9da4d3fad7a2f9ea3f2cb91af817d69a52dedb27177d67901ff44b8"

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
