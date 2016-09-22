import _get from 'lodash.get';
import { createSelector } from 'reselect'

export const quizSelector = (state, id) => {
  return _get(state.quizzes, `entities.quizzes.${id}`);
}

export const quizMetaSelector = (state, id) => {
  return _get(state.quizzes, `meta.quizzes.${id}`);
}

export const itemsSelector = state => {
  return (state.quizzes.entities || {}).items;
}

export const quizItemsSelector = createSelector(
  quizSelector,
  itemsSelector,
  (quiz, items) => {
    if(!_get(quiz, 'data.items')) {
      return undefined;
    } else {
      return quiz.data.items.map(id => items[id]);
    }
  }
);
