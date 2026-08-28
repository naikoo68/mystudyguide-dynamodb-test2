// Central import of every model so the ODM registry is fully populated before
// we create tables, run $lookup aggregations, or resolve populate() refs.
import User from "./User.js";
import Stream from "./Stream.js";
import Subject from "./Subject.js";
import Topic from "./Topic.js";
import Session from "./Session.js";
import Quiz from "./Quiz.js";
import Question from "./Question.js";
import TestSeries from "./TestSeries.js";
import Attempt from "./Attempt.js";
import Exam from "./Exam.js";
import ExamPost from "./ExamPost.js";
import Coupon from "./Coupon.js";
import DocumentModel from "./Document.js";
import Feedback from "./Feedback.js";
import Institution from "./Institution.js";
import Message from "./Message.js";
import Notice from "./Notice.js";
import PracticeStream from "./PracticeStream.js";
import PracticeSubject from "./PracticeSubject.js";
import PracticeTopic from "./PracticeTopic.js";
import Settings from "./Settings.js";
import SmClass from "./SmClass.js";
import SmFile from "./SmFile.js";
import SmSubject from "./SmSubject.js";
import AiKey from "./AiKey.js";

export const models = {
  User, Stream, Subject, Topic, Session, Quiz, Question, TestSeries, Attempt,
  Exam, ExamPost, Coupon, Document: DocumentModel, Feedback, Institution, Message,
  Notice, PracticeStream, PracticeSubject, PracticeTopic, Settings, SmClass,
  SmFile, SmSubject, AiKey,
};

export default models;
