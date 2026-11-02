cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.2"
  sha256 arm:   "2d5c0179e862b2cb467cc2e46b8b569b82a1c4d63b148d68f45977765524ba02",
         intel: "d455813a88094d910b18b773d708565135558038689056c50684a3686cc711cd"

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
