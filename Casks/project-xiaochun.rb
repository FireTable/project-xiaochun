cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.7"
  sha256 arm:   "dbbd5d7ff058e87169679b9d39edf977e007ad51985ede54bdf215b8b0af9591",
         intel: "713672dbf5758af520fb71b6d8e6692b591452f367cef1d99e2c7f676e23a312"

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
