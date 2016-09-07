const gulp = require('gulp');
const nodemon = require('gulp-nodemon');

const constants = require('./constants');

module.exports = () => {
  nodemon({
    script: './bin/www',
    ext: 'js',
    watch: constants.NODEMON_PATHS,
    env: {
      NODE_ENV: 'development',
      MONGO_URI: 'mongodb://localhost/quiznator',
      CLIENT_ID: 'quiznatorApp',
      CLIENT_SECRET: 'Qb4FIoEsStq9dAKilsvJ3l2pP1QYYZsU'
    }
  });
};
