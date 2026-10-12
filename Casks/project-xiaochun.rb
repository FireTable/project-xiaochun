cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.25"
  sha256 arm:   "050db358d853ef89c0e8de598658a0c81e96a7cef192e106492d495c5bf4a848",
         intel: "a1e64a822dd7b19297da3aca9ee720f2d25ec59be3b73ba2ce85b9f8632a20a2"

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
