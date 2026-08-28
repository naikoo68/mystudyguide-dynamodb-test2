// Central import of every model so the ODM registry is fully populated before
// we create tables, run $lookup aggregations, or resolve populate() refs.
//
// registerModelPlugins is imported FIRST so the global tenant plugin (which adds
// `tenantId` to every schema) is registered before any schema is compiled.
import "../config/registerModelPlugins.js";

import AiKey from "./AiKey.js";
import Attempt from "./Attempt.js";
import CbtAttempt from "./CbtAttempt.js";
import CbtRegistration from "./CbtRegistration.js";
import CompanionItem from "./CompanionItem.js";
import ContentShare from "./ContentShare.js";
import Coupon from "./Coupon.js";
import DocumentModel from "./Document.js";
import EmailOtp from "./EmailOtp.js";
import Exam from "./Exam.js";
import ExamPost from "./ExamPost.js";
import FbSchedule from "./FbSchedule.js";
import Feedback from "./Feedback.js";
import Institution from "./Institution.js";
import Message from "./Message.js";
import Notice from "./Notice.js";
import PracticeStream from "./PracticeStream.js";
import PracticeSubject from "./PracticeSubject.js";
import PracticeTopic from "./PracticeTopic.js";
import PublicAttempt from "./PublicAttempt.js";
import Question from "./Question.js";
import Quiz from "./Quiz.js";
import Review from "./Review.js";
import Session from "./Session.js";
import Settings from "./Settings.js";
import SmClass from "./SmClass.js";
import SmFile from "./SmFile.js";
import SmSubject from "./SmSubject.js";
import Stream from "./Stream.js";
import Subject from "./Subject.js";
import Tenant from "./Tenant.js";
import TestSeries from "./TestSeries.js";
import Topic from "./Topic.js";
import TrialClaim from "./TrialClaim.js";
import User from "./User.js";
import UserManual from "./UserManual.js";

export const models = {
  AiKey, Attempt, CbtAttempt, CbtRegistration, CompanionItem, ContentShare,
  Coupon, Document: DocumentModel, EmailOtp, Exam, ExamPost, FbSchedule,
  Feedback, Institution, Message, Notice, PracticeStream, PracticeSubject,
  PracticeTopic, PublicAttempt, Question, Quiz, Review, Session, Settings,
  SmClass, SmFile, SmSubject, Stream, Subject, Tenant, TestSeries, Topic,
  TrialClaim, User, UserManual,
};

export default models;
