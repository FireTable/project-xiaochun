cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.24"
  sha256 arm:   "4be712f31a5b140f7d7f19e25ab9770451431999528b00e74c4fa8d8d9399866",
         intel: "354979f5b10172081b7a0a1fd5588b86bfe297e7a88f20b7b209d3679c5bf169"

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
