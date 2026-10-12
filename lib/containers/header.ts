import { createSelector } from "reselect";

import type { HyperState, HyperDispatch, ITab } from "../../typings/hyper";
import {
    closeTab,
    changeTab,
    maximize,
    openHamburgerMenu,
    unmaximize,
    minimize,
    close,
} from "../actions/header";
import { setTabTitle } from "../actions/sessions";
import { requestTermGroup } from "../actions/term-groups";
import Header from "../components/header";
import { getRootGroups } from "../selectors";
import { connect } from "../utils/plugins";

const isMac = /Mac/.test(navigator.userAgent);

const getSessions = ({ sessions }: HyperState) => sessions.sessions;
const getActiveRootGroup = ({ termGroups }: HyperState) =>
    termGroups.activeRootGroup;
const getActiveSessions = ({ termGroups }: HyperState) =>
    termGroups.activeSessions;
const getActivityMarkers = ({ ui }: HyperState) => ui.activityMarkers;
const getTabTitles = ({ sessions }: HyperState) => sessions.tabTitles;
const getTabs = createSelector(
    [
        getSessions,
        getRootGroups,
        getActiveSessions,
        getActiveRootGroup,
        getActivityMarkers,
        getTabTitles,
    ],
    (
        sessions,
        rootGroups,
        activeSessions,
        activeRootGroup,
        activityMarkers,
        tabTitles,
    ) =>
        rootGroups.map((t): ITab => {
            const activeSessionUid = activeSessions[t.uid];
            const session = sessions[activeSessionUid];
            return {
                uid: t.uid,
                // ユーザーが付けた名前を優先し、無ければシェル由来のタイトルを使う
                title: tabTitles[t.uid] || session.title,
                isActive: t.uid === activeRootGroup,
                hasActivity: activityMarkers[session.uid],
            };
        }),
);

const mapStateToProps = (state: HyperState) => {
    return {
        // active is an index
        isMac,
        tabs: getTabs(state),
        activeMarkers: state.ui.activityMarkers,
        borderColor: state.ui.borderColor,
        backgroundColor: state.ui.backgroundColor,
        maximized: state.ui.maximized,
        fullScreen: state.ui.fullScreen,
        showHamburgerMenu: state.ui.showHamburgerMenu,
        showWindowControls: state.ui.showWindowControls,
        defaultProfile: state.ui.defaultProfile,
        profiles: state.ui.profiles,
    };
};

const mapDispatchToProps = (dispatch: HyperDispatch) => {
    return {
        onCloseTab: (i: string) => {
            dispatch(closeTab(i));
        },

        onChangeTab: (i: string) => {
            dispatch(changeTab(i));
        },

        maximize: () => {
            dispatch(maximize());
        },

        unmaximize: () => {
            dispatch(unmaximize());
        },

        openHamburgerMenu: (coordinates: { x: number; y: number }) => {
            dispatch(openHamburgerMenu(coordinates));
        },

        minimize: () => {
            dispatch(minimize());
        },

        close: () => {
            dispatch(close());
        },

        openNewTab: (profile: string) => {
            dispatch(requestTermGroup(undefined, profile));
        },

        onRenameTab: (uid: string, title: string) => {
            dispatch(setTabTitle(uid, title));
        },
    };
};

export const HeaderContainer = connect(
    mapStateToProps,
    mapDispatchToProps,
    null,
)(Header, "Header");

export type HeaderConnectedProps = ReturnType<typeof mapStateToProps> &
    ReturnType<typeof mapDispatchToProps>;
