ALTER TABLE questions ADD COLUMN type TEXT NOT NULL DEFAULT 'multiple_choice';
ALTER TABLE questions ADD COLUMN image_url TEXT;
ALTER TABLE options ADD COLUMN image_url TEXT;
ALTER TABLE options ADD COLUMN sort_order INT NOT NULL DEFAULT 0;
ALTER TABLE game_answers ALTER COLUMN option_id DROP NOT NULL;
ALTER TABLE game_answers ADD COLUMN answer_data JSONB;
