cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.13"
  sha256 arm:   "31ce42a35f4e6fe37334f33fe8169279535fa7fff0e349def6a198871f49be5e",
         intel: "3b12fc44240b742e71c9586c7747374e8914d0360d9833971225a2abab982f9c"

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
