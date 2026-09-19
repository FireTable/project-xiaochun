cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.4"
  sha256 arm:   "92608c8d51785141ac5aaee30073c3a6a47192d0b5abc846a84cf95f78e677d7",
         intel: "4fbf036b99d9d5cb8e1a6181222a187dafb065e3452f1ddb15e0a547dfd80c11"

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
