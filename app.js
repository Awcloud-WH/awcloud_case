angular.module('app', [])

.provider("ppp0", {
	$get: [function(){
		return { name: 'ppp0' }
	}]
})

.provider("ppp1", [function(){
	this.$get = [function(){
		return { name: 'ppp1' }
	}];
}])

.factory("ppp2", [function(){
	return { name: 'ppp2' }
}])

.service('ppp3', function($http){
	this.name = 'ppp3'
})



.directive('userProfile1', [function(){
	return {
		restrict: "A",
		link: function(scope, element, attrs){
			
		}
	};
}])

.directive('userProfile', [function(){
	function UserProfileController(){
		console.log(this, arguments);
	}
	//UserProfileController.$inject = ['$scope', '$element', '$attrs', '$transclude']
	//Controller
	return {
		priority: 0,
		templateUrl: 'tmpl/user-profile.html',
		replace: true,
		transclude: {
			'avatar': '?userAvatar',
			'description': '?userDescription'
		},
		restrict: "AE",
		scope: {
			name: '<',
			avatar: '<name',
			avatarUrl: '@'
		},
		controller: UserProfileController,
		controllerAs: 'profile',
		compile: function compile(element, attrs, transclude){
			console.log('compile', arguments);
			return function postLink(scope, element, attrs, controller){
				console.log('postLink')
			}
		},
		link: function postLink(scope, element, attrs){
			console.log('link')
		}
	};
}])
.directive('userAvatar', [function(){
	return {
		priority: 0,
		template: '<div><img ng-src="src"></div>',
		replace: true,
		restrict: "AE",
		//require: '^userProfile',
		scope: {
			title: '<',
			src: '@'
		},
		controller: function($scope, $element, $attrs, $transclude){
			console.log($scope)
		},
		link: function postLink(scope, element, attrs){
			console.log(45555)
		}
	};
}])

.controller('ngModuleAPI', function($scope, ppp0, ppp1, ppp2, ppp3){
	//console.log(this, $scope, arguments);
	this.methods = [
		'provider', 'factory', 'service',
		'animation', 'component', 'controller', 'decorator',
		'directive', 'filter'
	]
	this.statements = [
		'value', 'constant'
	]
	this.other = [ 'config', 'run' ]
	//console.log(arguments, this)
})
