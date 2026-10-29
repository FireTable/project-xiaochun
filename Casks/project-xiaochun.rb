cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.1"
  sha256 arm:   "444c0cbc1e905ac9d8db182d99b473bf73cfebdcde3552b7bd1ffc951b86765e",
         intel: "faae4551c231c779e969559f76fda68b7190261d2e0044655c9d13cbb9e468f9"

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
