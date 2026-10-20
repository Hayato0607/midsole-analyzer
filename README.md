# ミッドソール圧縮アナライザー

真横から撮ったランニングシューズのスロー動画から、接地中のミッドソールの厚みの変化を追い、ヒール・ミッド・フォアの圧縮率（%）を出すWebアプリです。動画はブラウザの中だけで処理され、どこにも送信されません。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | 画面の骨組み（ボタン、説明文など） |
| `style.css` | 見た目（色、文字、レイアウト） |
| `app.js` | 画面の動き（動画の読み込み、再生、点のドラッグ、グラフ、CSV書き出し） |
| `core.js` | 解析の中身（靴とミッドソールの自動検出、追跡、厚みの推定） |

## ローカルで使う・編集する

`index.html` をChromeかEdgeで開けば、そのまま動きます（サーバー不要）。ファイルを編集して保存し、ブラウザを再読み込みすると反映されます。

## GitHubに公開する（初回）

1. GitHubで新しいリポジトリ `midsole-analyzer` を作る（READMEなどは追加しない）
2. このフォルダでターミナル（PowerShell）を開いて実行する

```
git init
git add .
git commit -m "ミッドソール圧縮アナライザー 初版"
git branch -M main
git remote add origin https://github.com/Hayato0607/midsole-analyzer.git
git push -u origin main
```

3. リポジトリの Settings → Pages → Build and deployment で、Source を「Deploy from a branch」、Branch を `main` と `/(root)` にして Save
4. 1〜2分後に `https://hayato0607.github.io/midsole-analyzer/` で開けるようになる

## 編集したあとに更新する

```
git add .
git commit -m "変更内容のメモ"
git push
```

## 注意

- 動画（.mov / .mp4）とCSVは `.gitignore` でリポジトリに入らないようにしています。
- 文字は Google Fonts を読み込んでいます。オフラインのときは代わりのフォントで表示されます。
