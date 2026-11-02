cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.2"
  sha256 arm:   "44b43d40ee78fd3da5a468216bbd868a83921084a8c70722ad6f36a23257f0f4",
         intel: "92d315878b638614f176aadcd829470eae59a03a55aec5aba05f3f683fb045b5"

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
