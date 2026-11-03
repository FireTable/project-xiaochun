cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.8"
  sha256 arm:   "9444b10de8b7c7e2f4d73e3f4070313b2690415a18bb283f16518edf0547a099",
         intel: "b121ecd2903484fba098502ed414f2c604e74aa1ad3393cc373faf214c5ba6f8"

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
