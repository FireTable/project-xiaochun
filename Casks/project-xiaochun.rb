cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.12"
  sha256 arm:   "aa42e16e9bed8242f7eb3263be89afda23f7303706f150a4bb2eb5ee0e1b0340",
         intel: "ddc0953cdeaa98d6d642ab608530fc229ad6d0d9462d0b649d73fe335d1d0056"

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
