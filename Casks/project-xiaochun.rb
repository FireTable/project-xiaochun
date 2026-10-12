cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.27"
  sha256 arm:   "6aa88dff313c4f342447033eada1f10f4c1e0847620ee21be42e342b344ac3f1",
         intel: "c53dc3eca0a5370cc93958dd29d32779240d01f2bf95c741d1237a04399daae8"

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
