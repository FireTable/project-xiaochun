cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.28"
  sha256 arm:   "8f4b384eb1c4731557769ed0053c578a26b8182c98aecc2cb744258aa766eea4",
         intel: "40ec8b2b8076ca1e022a6830fef3de4489e64fad2eb116f88b836358f9b741e8"

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
