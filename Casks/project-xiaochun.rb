cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.16"
  sha256 arm:   "4d2fb3bbf2a75a779d321786a2da59bda77496bc30f466f8b945d034257d5201",
         intel: "565ea25650055fb7ad0b12b4957945f16356ccac8c315ed4128a4f66d46b2f35"

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
