import pandas as pd

# 入力ファイル（stops.txtのパスを指定）
input_file = "stops.txt"
output_file = "stops_deduped.txt"

# CSVを読み込み
df = pd.read_csv(input_file)

# stop_name（駅名）が重複している行を削除（先に出た1件だけ残す）
df_unique = df.drop_duplicates(subset="stop_name", keep="first")

# 結果を保存（元の列構造を保ったまま）
df_unique.to_csv(output_file, index=False)

print(f"✅ 重複駅名を削除しました。出力ファイル: {output_file}")
print(f"削除前: {len(df)}行 → 削除後: {len(df_unique)}行")
