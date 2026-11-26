CREATE TABLE marketplace_releases (
  template text NOT NULL,
  version text NOT NULL,
  revision text NOT NULL,
  installer text NOT NULL,
  image text,
  PRIMARY KEY (template, version)
);
