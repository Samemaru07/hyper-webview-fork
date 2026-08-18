# 辞書データの出典

`skk-jisyo-s.ts`は、[skk-dev/dict](https://github.com/skk-dev/dict)が配布する
`SKK-JISYO.S`を元に生成した．

- 元データ: https://github.com/skk-dev/dict/blob/master/SKK-JISYO.S
- ライセンス: GNU General Public License version 2, or (at your option) any later version
- Maintainer: SKK Development Team <skk@ring.gr.jp>

## 変換内容

- EUC-JPからUTF-8に変換
- コメント行(`;;`で始まる行)を除去
- 送り仮名エントリ(見出し語末尾がひらがな以外、例: `わるs`)を除去
  (このforkのSKK実装は現時点で送り仮名変換に未対応のため)
- `見出し語 /候補1/候補2/.../`形式を`{"見出し語": ["候補1", "候補2"]}`相当のTSオブジェクトリテラルに変換
  (`.json`ではなく`.ts`にしているのは、このプロジェクトのwebpack.config.tsに設定された
  古いjson-loaderがwebpack5のネイティブJSON対応と衝突するため)
- 候補の注釈(`;`以降の説明文)を除去
