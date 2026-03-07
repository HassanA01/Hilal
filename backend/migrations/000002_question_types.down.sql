ALTER TABLE game_answers DROP COLUMN answer_data;
ALTER TABLE game_answers ALTER COLUMN option_id SET NOT NULL;
ALTER TABLE options DROP COLUMN sort_order;
ALTER TABLE options DROP COLUMN image_url;
ALTER TABLE questions DROP COLUMN image_url;
ALTER TABLE questions DROP COLUMN type;
