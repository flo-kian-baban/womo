-- Rename verifiedFIT columns to PARR (Predicted Audience Receptivity Rate)
-- Applied directly via webdev_execute_sql; recorded here for journal sync
ALTER TABLE match_records RENAME COLUMN verifiedFITScore TO parrScore;
ALTER TABLE match_records RENAME COLUMN verifiedFITLabel TO parrLabel;
ALTER TABLE match_records RENAME COLUMN verifiedFITSignalBreakdown TO parrSignalBreakdown;
