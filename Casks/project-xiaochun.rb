cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.30"
  sha256 arm:   "0c7d56963d81754722ea20e74f9e8799bcbe108d45aac729e660fe7a93e6987e",
         intel: "fb89b4c3eee11354d90a6d804a13ce8c5c47076aadb0f810447de87075c6c9c6"

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
