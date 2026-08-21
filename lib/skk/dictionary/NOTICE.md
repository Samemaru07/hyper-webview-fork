# 辞書データの出典

`skk-jisyo-s.ts`・`skk-jisyo-l.ts`はいずれも、[skk-dev/dict](https://github.com/skk-dev/dict)が
配布する辞書ファイルを元に生成した．

- 元データ:
  - https://github.com/skk-dev/dict/blob/master/SKK-JISYO.S (約2,400エントリ、数十KB)
  - https://github.com/skk-dev/dict/blob/master/SKK-JISYO.L (約13万エントリ、約5MB)
- ライセンス: GNU General Public License version 2, or (at your option) any later version
- Maintainer: SKK Development Team <skk@ring.gr.jp>

## 変換内容

- EUC-JPからUTF-8に変換
- コメント行(`;;`で始まる行)を除去
- 見出し語が「ひらがな/ー」、または「ひらがな/ー + 送り仮名マーカー1文字」
  (例: `おくr`、形容詞の場合は`わるi`のように母音1文字のこともある)に一致するエントリを採用
  (このforkのSKK実装は、送り仮名を1モーラ分のみ対応)
- 上記以外の特殊な見出し語(例: `Cyrillic`/`Greek`等、キリル文字・ギリシャ文字入力用のSKK標準エントリ)も
  元データにそのまま残っているものは除外せず含めている。ただしこのforkのSKK実装では
  `reading`が常にひらがなのため、これらのエントリに実際に到達することはない
- `見出し語 /候補1/候補2/.../`形式を`{"見出し語": ["候補1", "候補2"]}`相当のTSオブジェクトリテラルに変換
  (`.json`ではなく`.ts`にしているのは、このプロジェクトのwebpack.config.tsに設定された
  古いjson-loaderがwebpack5のネイティブJSON対応と衝突するため)
- 候補の注釈(`;`以降の説明文)を除去

## 使い分け(lib/skk/dictionary.ts)

`SKK-JISYO.L`はサイズが大きく、アプリ起動時に同期的にバンドル読み込みすると
起動時間に無視できない影響(手元の計測で100〜300ms程度)が出るため、
SKKモードが初めて有効化されたタイミングで動的import(非同期)する方式にしている．
読み込みが完了するまでの間は、常にバンドルされている`SKK-JISYO.S`を代わりに使う．
