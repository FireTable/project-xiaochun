cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.11"
  sha256 arm:   "b2a9a62afc0f4b3e626019cf091167b7c3cd8d546c8964e345f818301677543c",
         intel: "86184e3c4dce390f9964bcf77bd26dd8f25f0957ca96028ed340baefbbb9a035"

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
