import {validateReviewPreview} from './release-validator.mjs';

// Internal projection only. This does not approve or activate a public release.
export function generateReleaseCandidate(authoring) {
 if (!authoring || authoring.environment !== 'local_review_only' ||
     authoring.releaseApproved !== false || authoring.publishedAt !== null ||
     authoring.humanPublicApproval !== 'pending') throw Error('内部候補の承認状態が不正');
 const value = authoring.displayData;
 if (!value || value.dates?.humanApprovedAt !== null ||
     value.temporalRecords?.some(t => t.publishedAt !== null)) throw Error('候補に公開日時を設定できません');
 const candidate = JSON.parse(JSON.stringify({
  schemaVersion:value.schemaVersion, contentVersion:value.contentVersion, editionId:value.editionId,
  master:value.master, lessons:value.lessons, dates:value.dates,
  publicReviews:value.publicReviews, temporalRecords:value.temporalRecords,
 }));
 return validateReviewPreview(candidate);
}
