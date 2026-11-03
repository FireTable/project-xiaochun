cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.7"
  sha256 arm:   "24683efa80060048f37ca07b909987c01d3006c81c31aeee975347f3ec1cc76c",
         intel: "254286e7ea5f8bde40cf8799c80e6f4a90ed6c0c7e4191cd6c091479025fe6a1"

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
