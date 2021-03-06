const mongoose = require('mongoose');
const _ = require('lodash');
const Promise = require('bluebird');
const hl = require('highland');

const quizTypes = require('app-modules/constants/quiz-types');

function cloneShallow(options) {
  const { query, newAttributes } = options;

  const stream = this.find(query).cursor();

  const oldIdToNewId = {};
  const quizRefs = {};

  return new Promise((resolve, reject) => {
    hl(stream)
      .map(quiz => {
        const asObject = quiz.toObject();
        const withoutIdentifiers = _.omit(asObject, ['_id', 'createdAt', 'updatedAt']);

        return Object.assign({},
          withoutIdentifiers,
          newAttributes || {},
          { _oldId: asObject._id }
        );
      })
      .map(newQuiz => {
        const promise = this.create(newQuiz)
          .then(quiz => {
            oldIdToNewId[newQuiz._oldId.toString()] = quiz._id.toString();

            return quiz;
          });

        return hl(promise);
      })
      .parallel(20)
      .tap(clonedQuiz => {
        if(_.get(clonedQuiz, 'data.quizId')) {
          quizRefs[clonedQuiz._id.toString()] = clonedQuiz.data.quizId;
        }
      })
      .done((err) => {
        resolve({ quizRefs, oldIdToNewId });
      });
  });
}

function formatTags(next) {
  this.tags = _.chain(this.tags || [])
    .map(tag => tag.toLowerCase())
    .uniq()
    .value();

  next();
}

function removeDependent(next) {
  Promise.all([
    mongoose.models.QuizAnswer.remove({ quizId: this._id }),
    mongoose.models.PeerReview.remove({ quizId: this._id })
  ])
  .then(() => next())
  .catch(next);
}

module.exports = schema => {
  schema.statics.findAnswerable = function(query) {
    const answerableTypes = [quizTypes.MULTIPLE_CHOICE, quizTypes.CHECKBOX, quizTypes.ESSAY, quizTypes.OPEN];

    const modifiedQuery = Object.assign({}, { type: { $in: answerableTypes } }, query);

    return this.find(modifiedQuery);
  }

  schema.statics.clone = function(options) {
    return cloneShallow.bind(this, options)()
      .then(data => {
        const { quizRefs, oldIdToNewId } = data;

        return new Promise((resolve, reject) => {
          hl(Object.keys(quizRefs))
            .map(refererId => {
              const targetId = oldIdToNewId[quizRefs[refererId]];

              const promise = targetId
                ? this.update({ _id: refererId }, { $set: { 'data.quizId': targetId } })
                : Promise.resolve();

              return hl(promise);
            })
            .parallel(20)
            .done(() => resolve());
        });
      });
  }

  schema.methods.getStats = function() {
    return Promise.all([this.getAnswersCounts(), this.getAnswerDistribution()])
      .spread((answerCounts, answerDistribution) => {
        return {
          answerCounts,
          answerDistribution
        }
      });
  }

  schema.statics.whereTags = function(tags) {
    return this.where('tags').in(tags);
  }

  schema.methods.canInspectAnswers = function(user) {
    return this.userId.toString() === user._id.toString();
  }

  schema.methods.getAnswerDistribution = function() {
    if([quizTypes.CHECKBOX, quizTypes.MULTIPLE_CHOICE].indexOf(this.type) < 0) {
      return Promise.resolve({});
    }

    const aggregation = [
      { $match: { quizId: this._id } },
      this.type === quizTypes.CHECKBOX ? { $unwind: '$data' } : undefined,
      { $group: { _id: '$data', count: { $sum: 1 } } }
    ].filter(p => !!p);

    return mongoose.models.QuizAnswer.aggregate(aggregation)
      .exec()
      .then(results => {
        return results.map(value => {
          return {
            value: this.data.items.find(item => item.id === value._id) || value._id,
            count: value.count
          }
        });
      });
  }

  schema.methods.getAnswersCounts = function() {
    let query;

    const getPeerReviewAggregation = uniqueOnly => [
      { $match: { sourceQuizId: this._id } },
      uniqueOnly ? { $group: { _id: '$giverAnswererId' } } : undefined,
      { $group: { _id: null, count: { $sum: 1 } } }
    ].filter(p => !!p);

    const getAnswerAggregation = uniqueOnly => [
      { $match: { quizId: this._id } },
      uniqueOnly ? { $group: { _id: '$answererId' } } : undefined,
      { $group: { _id: null, count: { $sum: 1 } } }
    ].filter(p => !!p);

    if(this.type === quizTypes.PEER_REVIEW) {
      query = Promise.all([
        mongoose.models.PeerReview.aggregate(getPeerReviewAggregation(true)).exec(),
        mongoose.models.PeerReview.aggregate(getPeerReviewAggregation(false)).exec()
      ]);
    } else {
      query = Promise.all([
        mongoose.models.QuizAnswer.aggregate(getAnswerAggregation(true)).exec(),
        mongoose.models.QuizAnswer.aggregate(getAnswerAggregation(false)).exec()
      ]);
    }

    return query.spread((unique, all) => {
      return {
        unique: _.get(unique, '[0].count') || 0,
        all: _.get(all, '[0].count') || 0
      }
    });
  }

  schema.pre('save', formatTags);

  schema.pre('remove', removeDependent);
}
